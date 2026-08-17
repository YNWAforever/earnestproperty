export interface VercelBlobMetadata {
  url: string;
  downloadUrl: string;
  pathname: string;
  contentType: string;
  size: number;
}

export interface VercelBlobPutInput {
  pathname: string;
  body: BodyInit;
  contentType: string;
}

export interface VercelBlobStore {
  put(input: VercelBlobPutInput): Promise<VercelBlobMetadata>;
}

export declare function createVercelBlobStore(options: {
  token: string;
  fetchImpl?: typeof fetch;
}): VercelBlobStore;
