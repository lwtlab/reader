param([ValidateSet('directory', 'file', 'inspect', 'add-au')][string]$Operation)
$ErrorActionPreference = 'Stop'
$target = $env:READER_NATIVE_ACL_TARGET
if (!$target) { throw 'Missing owned object' }
$item = Get-Item -LiteralPath $target -Force
if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { throw 'Refusing a reparse point' }
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
if ($Operation -eq 'directory' -or $Operation -eq 'file') {
  if ($Operation -eq 'directory') {
    if (!$item.PSIsContainer -or @(Get-ChildItem -LiteralPath $target -Force).Count -ne 0) { throw 'Only a fresh empty directory may be protected' }
    $security = [System.Security.AccessControl.DirectorySecurity]::new()
  } else {
    if ($item.PSIsContainer -or $item.Length -ne 0) { throw 'Only a fresh empty file may be protected' }
    $security = [System.Security.AccessControl.FileSecurity]::new()
  }
  $security.SetOwner($user)
  $security.SetAccessRuleProtection($true, $false)
  $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($user, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.AccessControlType]::Allow)
  $security.AddAccessRule($rule)
  # The directory is empty and files have no children. Parent/siblings are never modified.
  Set-Acl -LiteralPath $target -AclObject $security
}
if ($Operation -eq 'add-au') {
  if ($item.PSIsContainer) { throw 'Negative control must be a synthetic file' }
  $security = Get-Acl -LiteralPath $target
  $security.AddAccessRule([System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new('S-1-5-11'), [System.Security.AccessControl.FileSystemRights]::Read, [System.Security.AccessControl.AccessControlType]::Allow))
  Set-Acl -LiteralPath $target -AclObject $security
}
$actual = Get-Acl -LiteralPath $target
if (!$actual.AreAccessRulesCanonical) { throw 'Noncanonical ACL' }
$rules = @($actual.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object {
  "$($_.IdentityReference.Value)|$([int]$_.AccessControlType)|$([int]$_.FileSystemRights)|$([int]$_.InheritanceFlags)|$([int]$_.PropagationFlags)|$($_.IsInherited)"
} | Sort-Object)
$onlyUser = $rules.Count -eq 1 -and $rules[0] -eq "$($user.Value)|0|2032127|0|0|False"
$owner = $actual.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
[ordered]@{ owner = $owner; group = $actual.GetGroup([System.Security.Principal.SecurityIdentifier]).Value; protected = $actual.AreAccessRulesProtected; rules = $rules; currentUserOnly = $onlyUser -and $owner -eq $user.Value -and $actual.AreAccessRulesProtected } | ConvertTo-Json -Compress
