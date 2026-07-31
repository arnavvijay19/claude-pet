using System;

internal static class Program
{
    internal const int ProtocolVersion = 1;

    private static int Main(string[] args)
    {
        // AnyCPU executables use the x64 CLR on supported x64 Windows while avoiding the
        // PE32+ managed-loader path. Fail closed if Windows ever selects a 32-bit CLR.
        if (!Environment.Is64BitProcess)
        {
            return 64;
        }
        if (args.Length == 1 && args[0] == "--protocol-version")
        {
            Console.Out.WriteLine(ProtocolVersion);
            return 0;
        }
        return 64;
    }
}
