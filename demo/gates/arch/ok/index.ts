// Фікстура архітектурного гейта — КОРЕКТНИЙ граф імпортів (жодного forbidden/). depcruise → exit 0.
import { greet } from './util';

export function hello(name: string): string {
  return greet(name);
}
