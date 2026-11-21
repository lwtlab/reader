param([ValidateSet('prepare', 'restore')][string]$Operation = 'prepare')
# RUNNER_TEMP is reserved. Protect the actual disposable job temp directory.
# Inheritable ACEs can also narrow existing unprotected children; restore the
# original directory ACL afterwards and verify an existing synthetic child's ACL.
$ErrorActionPreference = 'Stop'
$directory = [System.IO.Path]::GetFullPath($env:RUNNER_TEMP)
if ($directory -eq [System.IO.Path]::GetPathRoot($directory)) { throw 'Refusing a drive root' }
if ((Get-Item -LiteralPath $directory).Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'Refusing a redirected temp directory' }
$backup = Join-Path $directory 'reader-native-original-acl.json'
$existingProbe = Join-Path $directory 'reader-native-existing-permission-probe'
$sections = [System.Security.AccessControl.AccessControlSections]'Access, Owner, Group'
function Restore-DirectoryAcl([string]$Descriptor) {
  $restored = [System.Security.AccessControl.DirectorySecurity]::new()
  $restored.SetSecurityDescriptorSddlForm($Descriptor, $sections)
  Set-Acl -LiteralPath $directory -AclObject $restored
}
if ($Operation -eq 'restore') {
  if (!(Test-Path -LiteralPath $backup)) {
    Write-Output 'Native checkout ACL was not prepared; no saved ACL to restore'
    exit 0
  }
  $saved = [System.IO.File]::ReadAllText($backup) | ConvertFrom-Json
  Restore-DirectoryAcl $saved.directory
  try {
    if ((Get-Acl -LiteralPath $existingProbe).GetSecurityDescriptorSddlForm($sections) -ne $saved.existingProbe) { throw 'Existing synthetic child ACL did not restore' }
  } finally {
    Remove-Item -LiteralPath $existingProbe -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $backup -Force
  }
  Write-Output 'Native checkout directory and existing synthetic child ACL restored'
  exit 0
}
if ((Test-Path -LiteralPath $backup) -or (Test-Path -LiteralPath $existingProbe)) { throw 'Native checkout ACL controls must be fresh' }
$original = (Get-Acl -LiteralPath $directory).GetSecurityDescriptorSddlForm($sections)
[System.IO.File]::WriteAllText($existingProbe, 'synthetic')
$originalChild = (Get-Acl -LiteralPath $existingProbe).GetSecurityDescriptorSddlForm($sections)
$owner = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = [System.Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($owner)
$acl.SetAccessRuleProtection($true, $false)
$inherit = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
$rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
  $owner, [System.Security.AccessControl.FileSystemRights]::FullControl,
  $inherit, [System.Security.AccessControl.PropagationFlags]::None,
  [System.Security.AccessControl.AccessControlType]::Allow)
$acl.AddAccessRule($rule)
$env:READER_NATIVE_AUTH_PROBE = Join-Path $directory 'reader-native-permissions-probe'
try {
  Set-Acl -LiteralPath $directory -AclObject $acl
  [System.IO.File]::WriteAllText($backup, (@{ directory = $original; existingProbe = $originalChild } | ConvertTo-Json -Compress))
  # Same Node creation API as checkout, before introducing any credential.
  node -e 'require("node:fs").writeFileSync(process.env.READER_NATIVE_AUTH_PROBE,"synthetic",{mode:0o600,flag:"wx"})'
  if ($LASTEXITCODE -ne 0) { throw 'Native checkout permission probe creation failed' }
  foreach ($candidate in @($directory, $env:READER_NATIVE_AUTH_PROBE)) {
    $actual = Get-Acl -LiteralPath $candidate
    if ($actual.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $owner.Value) { throw 'Native checkout owner mismatch' }
    $rules = $actual.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
    if ($rules.Count -eq 0) { throw 'Native checkout has no access rule' }
    foreach ($access in $rules) {
      if ($access.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or $access.IdentityReference.Value -ne $owner.Value) { throw 'Native checkout access is not owner-only' }
    }
  }
} catch {
  # If backup persistence or the probe fails, roll back using the in-memory SD.
  Restore-DirectoryAcl $original
  Remove-Item -LiteralPath $existingProbe -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
  throw
} finally {
  Remove-Item -LiteralPath $env:READER_NATIVE_AUTH_PROBE -Force -ErrorAction SilentlyContinue
  Remove-Item Env:READER_NATIVE_AUTH_PROBE -ErrorAction SilentlyContinue
}
Write-Output 'Native checkout actual temp directory and Node child are owner-only'
