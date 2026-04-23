import { Project } from "ts-morph";
import { Calculator } from "./sample";

/**
 * A sample class with complex types and static properties.
 */
export declare class ComplexModule {
  static ɵfac: any;
  static ɵmod: any;
  static ɵinj: any;

  public promise: Promise<Project>;

  public method1(param: string): number;
  private method2(): void;
}

/**
 * An interface with members.
 */
export interface ComplexInterface {
  prop1: string;
  prop2: number;
  method(): void;
}

/**
 * A type alias.
 */
export type ComplexType = {
  key: string;
  value: number;
  promise: Promise<typeof Calculator>;
};
