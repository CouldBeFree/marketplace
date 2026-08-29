export interface Product {
  id: string;
  name: string;
  price_cents: number;
  currency: string;
}

export interface OrderItem {
  product_id: string;
  quantity: number;
  unit_price_cents: number;
}

export interface Order {
  id: string;
  status: string;
  items: OrderItem[];
  total_cents: number;
  currency: string;
  created_at: string;
}
