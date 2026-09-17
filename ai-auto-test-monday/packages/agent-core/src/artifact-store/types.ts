export interface ArtifactStore {
  getText(prefix: string, relativeKey: string): Promise<string | null>;
  putText(prefix: string, relativeKey: string, content: string): Promise<void>;
  deleteObject(prefix: string, relativeKey: string): Promise<void>;
  listRelativeKeys(prefix: string): Promise<string[]>;
  deletePrefix(prefix: string, relativeDir: string): Promise<void>;
  exists(prefix: string, relativeKey: string): Promise<boolean>;
}

export interface ArtifactStoreConfig {
  store: "fs" | "minio";
  fsBaseDir?: string;
  minioEndpoint?: string;
  minioBucket?: string;
  minioAccessKey?: string;
  minioSecretKey?: string;
  minioRegion?: string;
}
