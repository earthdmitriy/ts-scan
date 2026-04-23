declare const process: {
  argv: string[];
  cwd(): string;
  exit(code?: number): void;
  platform: string;
};
