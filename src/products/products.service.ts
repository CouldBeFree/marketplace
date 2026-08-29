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

  list(limit?: number, cursor?: string) {
    return paginate(this.products, limit, cursor);
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
}
