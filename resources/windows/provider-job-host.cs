using System;

internal static class Program
{
    internal const int ProtocolVersion = 1;

    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--protocol-version")
        {
            Console.Out.WriteLine(ProtocolVersion);
            return 0;
        }
        return 64;
    }
}
