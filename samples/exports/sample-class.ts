/**
 * A sample class.
 */
@Component
export class Calculator {
  /**
   * The version of the calculator.
   */
  public version: string;

  /**
   * Adds two numbers.
   */
  public add(a: number, b: number): number {
    return a + b;
  }

  private subtract(a: number, b: number): number {
    return a - b;
  }
}
