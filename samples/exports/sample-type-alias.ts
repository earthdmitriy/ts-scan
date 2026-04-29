// Type alias vs Interface sample
export type MyTypeAlias = {
  id: number;
  name: string;
};

export interface MyInterface {
  id: number;
  name: string;
}

// Union type
export type Status = "pending" | "active" | "inactive";

// Generic type alias
export type Response<T> = {
  data: T;
  status: number;
};
