DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email      text        NOT NULL UNIQUE,
  full_name  text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE products (
  id         bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  seller_id  bigint        NOT NULL REFERENCES users(id),
  title      text          NOT NULL,
  price      numeric(12,2) NOT NULL CHECK (price >= 0),
  created_at timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id            bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  buyer_id      bigint        NOT NULL REFERENCES users(id),
  status        text          NOT NULL CHECK (status IN ('pending','paid','shipped','completed','cancelled')),
  shipping_name text          NOT NULL,
  total         numeric(12,2) NOT NULL CHECK (total >= 0),
  created_at    timestamptz   NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id         bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id   bigint        NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id bigint        NOT NULL REFERENCES products(id),
  quantity   integer       NOT NULL CHECK (quantity > 0),
  unit_price numeric(12,2) NOT NULL CHECK (unit_price >= 0)
);
