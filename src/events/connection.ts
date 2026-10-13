import * as amqp from 'amqplib';

// Підключення до брокера подій. Адреса — ВИКЛЮЧНО з оточення (BROKER_URL), яке локально
// наповнює scripts/with-secrets.sh зі сховища ДЗ #11, а грейдер — через export + SKIP_VAULT=1.
// Жодних зашитих креденшелів у коді (контракт секретів курсу).
export function brokerUrl(): string {
  const url = process.env.BROKER_URL;
  if (!url) {
    throw new Error(
      'BROKER_URL не задано. Локально запускай через `npm run demo:*` (значення зі сховища ' +
        'ДЗ #11). Грейдеру: `export BROKER_URL=amqp://app:app@127.0.0.1:5672` + `export SKIP_VAULT=1`.',
    );
  }
  return url;
}

export async function connect(): Promise<amqp.ChannelModel> {
  return amqp.connect(brokerUrl());
}
