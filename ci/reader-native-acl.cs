using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

// SetSecurityInfo deliberately suppresses child propagation for a handle opened
// with MAXIMUM_ALLOWED. This is documented behavior, unlike Set-Acl/Persist:
// https://learn.microsoft.com/windows/win32/api/aclapi/nf-aclapi-setsecurityinfo
public static class ReaderNativeDirectoryAcl
{
    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern SafeFileHandle OpenDirectory(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetSecurityDescriptorOwner(IntPtr descriptor, out IntPtr owner, out bool defaulted);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetSecurityDescriptorGroup(IntPtr descriptor, out IntPtr group, out bool defaulted);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetSecurityDescriptorDacl(IntPtr descriptor, out bool present, out IntPtr acl, out bool defaulted);
    [DllImport("advapi32.dll")]
    private static extern uint SetSecurityInfo(SafeFileHandle handle, uint type, uint information, IntPtr owner, IntPtr group, IntPtr acl, IntPtr audit);

    public static void Apply(string directory, byte[] descriptor, bool protect)
    {
        if (descriptor == null || descriptor.Length == 0) throw new ArgumentException("Missing directory descriptor");
        GCHandle pinned = GCHandle.Alloc(descriptor, GCHandleType.Pinned);
        try
        {
            IntPtr pointer = pinned.AddrOfPinnedObject(), owner, group, acl;
            bool ignored, present;
            if (!GetSecurityDescriptorOwner(pointer, out owner, out ignored) ||
                !GetSecurityDescriptorGroup(pointer, out group, out ignored) ||
                !GetSecurityDescriptorDacl(pointer, out present, out acl, out ignored))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            if (!present || acl == IntPtr.Zero || owner == IntPtr.Zero)
                throw new ArgumentException("A non-null DACL and owner are required");
            // MAXIMUM_ALLOWED requests only rights already granted to this caller.
            // FILE_FLAG_BACKUP_SEMANTICS is required to open a directory handle.
            using (SafeFileHandle handle = OpenDirectory(directory, 0x02000000u, 7u, IntPtr.Zero, 3u, 0x02000000u, IntPtr.Zero))
            {
                if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
                uint information = 1u | 4u | (group == IntPtr.Zero ? 0u : 2u) | (protect ? 0x80000000u : 0x20000000u);
                uint error = SetSecurityInfo(handle, 1u, information, owner, group, acl, IntPtr.Zero);
                if (error != 0) throw new Win32Exception((int)error);
            }
        }
        finally { pinned.Free(); }
    }
}
