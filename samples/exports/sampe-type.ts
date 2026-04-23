export type Product = {
  productId: number;
  name: string;
  descripton: string;
  material: string;
  price: string;
};

export type PopulatedBucket = {
  goods: { product: Product; amount: number }[];
  total: number;
};
