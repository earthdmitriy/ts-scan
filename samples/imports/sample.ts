import {
  ComplexInterface,
  ComplexModule,
  ComplexType,
} from "../exports/sample-dependencies";
import { greet, value } from "./imported";

export const result = greet("sample") + value;

const x = new ComplexModule();
const y = null as unknown as ComplexInterface;
type z = ComplexType;
