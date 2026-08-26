export type Registry = "kitaqsign" | "kitaqnic";

export type EppResult = { code: number; message: string; reason?: string };
export type TrId = { clTRID?: string; svTRID: string };

export type EppEnvelope<T> = {
  result: EppResult;
  resData: T;
  trID: TrId;
};

export type EmptyResData = Record<string, never>;

export type DomainCheckResult = { name: string; avail: boolean; reason?: string };
export type DomainCheckResponse = { results: DomainCheckResult[] };

export type DomainCreateResponse = { domain: string; crDate: string; exDate: string };

export type DomainResponse = {
  domain: string;
  status: string[];
  registrant: string;
  contacts: Record<string, string>;
  nameservers: string[];
  period?: { unit: string; value: number };
  crDate: string;
  upDate?: string | null;
  exDate: string;
  trDate?: string | null;
  rgpStatus: string[];
};

export type DomainRenewResponse = { domain: string; exDate: string };

export type DomainTransferResponse = {
  domain: string;
  status: string;
  gainingRegistrar: string;
  losingRegistrar: string;
};

// Swagger の PollMessageDto に準拠
export type PollMessage = {
  id: number;              // int64
  msgType: string;
  payload: {
    domain?: string;
    status?: string;
    [key: string]: unknown;
  };
  qdate: string;
};

// GET /messages/poll のレスポンス resData
export type PollResponse = {
  count: number;
  message?: PollMessage;
};
