import { Injectable, NotFoundException } from '@nestjs/common';
import { Product } from '../common/models';
import { paginate } from '../common/pagination';

@Injectable()
export class ProductsService {
  private readonly products: Product[] = [
    { id: 'prod_1', name: 'Кавоварка', price_cents: 2600, currency: 'UAH' },
    { id: 'prod_2', name: 'Електрочайник', price_cents: 1500, currency: 'UAH' },
    { id: 'prod_3', name: 'Кухоль', price_cents: 300, currency: 'UAH' },
  ];
  private seq = this.products.length; // наступний id — prod_4, prod_5, …

  list(limit?: number, cursor?: string) {
    return paginate(this.products, limit, cursor);
  }

  // ДЗ #24: запис у каталог дозволено лише seller/admin (гейтить RolesGuard у контролері).
  // Сам сервіс ролей не знає — межа ролі вже пройдена гардом до цього виклику.
  create(input: { name: string; price_cents: number; currency?: string }): Product {
    const product: Product = {
      id: `prod_${++this.seq}`,
      name: input.name,
      price_cents: input.price_cents,
      currency: input.currency ?? 'UAH',
    };
    this.products.push(product);
    return product;
  }

  find(id: string): Product | undefined {
    return this.products.find((p) => p.id === id);
  }

  get(id: string): Product {
    const product = this.find(id);
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return product;
  }

  // --- Сід для provider-state (Pact). HTTP-шар in-memory (варіант Б), тож стан сідаємо
  //     саме в стор, який читає провайдер — а не в БД (її схема нормалізована й контракт
  //     ДЗ #9 із рядкових id/currency не представляє). ---

  // In-memory аналог INSERT ... ON CONFLICT DO NOTHING: додати товар, якщо його ще немає.
  seedIfAbsent(product: Product): void {
    if (!this.find(product.id)) {
      this.products.push(product);
    }
  }

  // Повна заміна каталогу. Provider-verification стартує з порожнього, щоб потрібний
  // товар сідав САМЕ stateHandler (інакше верифікація мовчки трималась би на дефолті).
  reset(products: Product[] = []): void {
    this.products.length = 0;
    this.products.push(...products);
  }
}
