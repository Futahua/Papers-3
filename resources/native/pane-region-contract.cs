// Contract used by the existing region compositor. The legacy helper has its own
// compiler unit; the experimental coordinator is built separately from that helper.
public sealed class SavedShape {
    public long Handle;
    public uint Pid;
    public int ClientPid;
    public byte[] Data;
}
