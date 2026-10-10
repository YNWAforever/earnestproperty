export interface VercelBlobMetadata {
  url: string;
  downloadUrl: string;
  pathname: string;
  contentType: string;
  size: number;
}

export interface VercelBlobPutInput {
  pathname: string;
  body: Blob | ArrayBuffer | ArrayBufferView;
  contentType: string;
  signal?: AbortSignal;
  /** Replace an existing file. Only allowed for `mls-variants/` paths. */
  allowOverwrite?: boolean;
}

export interface VercelBlobStore {
  put(input: VercelBlobPutInput): Promise<VercelBlobMetadata>;
}

export declare function createVercelBlobStore(options: {
  token: string;
  fetchImpl?: typeof fetch;
}): VercelBlobStore;
