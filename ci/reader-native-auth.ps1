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
function Get-CanonicalPermissions([string]$File) {
  $security = Get-Acl -LiteralPath $File
  if (!$security.AreAccessRulesCanonical) { throw 'Noncanonical ACL cannot be compared safely' }
  $rules = @($security.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object {
    "$($_.IdentityReference.Value)|$([int]$_.AccessControlType)|$([int]$_.FileSystemRights)|$([int]$_.InheritanceFlags)|$([int]$_.PropagationFlags)|$($_.IsInherited)"
  } | Sort-Object)
  return ([ordered]@{ owner = $security.GetOwner([System.Security.Principal.SecurityIdentifier]).Value; group = $security.GetGroup([System.Security.Principal.SecurityIdentifier]).Value; protected = $security.AreAccessRulesProtected; canonical = $security.AreAccessRulesCanonical; rules = $rules } | ConvertTo-Json -Compress)
}
function Show-SyntheticPermissionDifference([string]$Before, [string]$After) {
  # Closed roles/rights for the synthetic probe only; no account names or SIDs.
  $currentSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  foreach ($text in @($Before, $After)) {
    $snapshot = $text | ConvertFrom-Json
    $roles = @($snapshot.rules | ForEach-Object {
      $parts = $_.Split('|')
      $role = switch ($parts[0]) { $currentSid { 'current-user'; break } 'S-1-5-18' { 'system'; break } 'S-1-5-32-544' { 'administrators'; break } 'S-1-5-11' { 'authenticated-users'; break } 'S-1-1-0' { 'everyone'; break } 'S-1-3-0' { 'creator-owner'; break } default { 'other' } }
      "$role|$($parts[1..5] -join '|')"
    })
    Write-Output ([ordered]@{ protected = $snapshot.protected; canonical = $snapshot.canonical; rules = $roles } | ConvertTo-Json -Compress)
  }
}
if ($Operation -eq 'restore') {
  if (!(Test-Path -LiteralPath $backup)) {
    Write-Output 'Native checkout ACL was not prepared; no saved ACL to restore'
    exit 0
  }
  $saved = [System.IO.File]::ReadAllText($backup) | ConvertFrom-Json
  Restore-DirectoryAcl $saved.directory
  try {
    $after = Get-CanonicalPermissions $existingProbe
    if ($after -ne $saved.existingProbePermissions) {
      Show-SyntheticPermissionDifference $saved.existingProbePermissions $after
      throw 'Existing synthetic child permissions did not restore'
    }
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
$originalChildPermissions = Get-CanonicalPermissions $existingProbe
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
  [System.IO.File]::WriteAllText($backup, (@{ directory = $original; existingProbe = $originalChild; existingProbePermissions = $originalChildPermissions } | ConvertTo-Json -Compress))
  # Same Node creation API as checkout, before introducing any credential.
  node -e 'const key=require("node:crypto").generateKeyPairSync("rsa",{modulusLength:2048,privateKeyEncoding:{type:"pkcs1",format:"pem"},publicKeyEncoding:{type:"spki",format:"pem"}}).privateKey;require("node:fs").writeFileSync(process.env.READER_NATIVE_AUTH_PROBE,key,{mode:0o600,flag:"wx"})'
  if ($LASTEXITCODE -ne 0) { throw 'Native checkout permission probe creation failed' }
  foreach ($candidate in @($directory, $env:READER_NATIVE_AUTH_PROBE)) {
    $actual = Get-Acl -LiteralPath $candidate
    # Win32 OpenSSH explicitly accepts current user, local Administrators,
    # or SYSTEM as owner. Keep access ACEs restricted to the current user.
    $fileOwner = $actual.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
    if (@($owner.Value, 'S-1-5-32-544', 'S-1-5-18') -notcontains $fileOwner) { throw 'Native checkout owner is not trusted by OpenSSH' }
    $rules = $actual.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier])
    if ($rules.Count -eq 0) { throw 'Native checkout has no access rule' }
    foreach ($access in $rules) {
      if ($access.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or $access.IdentityReference.Value -ne $owner.Value) { throw 'Native checkout access is not owner-only' }
    }
  }
  $ssh = (Get-Command ssh.exe -CommandType Application | Select-Object -First 1).Source
  $keygen = Join-Path (Split-Path $ssh) 'ssh-keygen.exe'
  & $keygen -y -f $env:READER_NATIVE_AUTH_PROBE > $null
  if ($LASTEXITCODE -ne 0) { throw 'Actual OpenSSH rejected the synthetic Node-created private key' }
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
Write-Output 'Native checkout current-user-only access and actual OpenSSH private-key loading verified'
