export interface TransferPollMessage {
  transferId: string;
  // このメッセージが何回目の poll 試行か。1 origin。
  // レジストリが自動承認するまでの間、空振りが続く場合は再エンキューして attempt を +1 する。
  // 一定回数超えたら poll を諦めて transfer を expired 扱いにする (B10)。
  attempt: number;
}
