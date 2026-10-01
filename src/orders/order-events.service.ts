import { Injectable } from '@nestjs/common';
import { Observable, Subject, filter } from 'rxjs';

export interface OrderEvent {
  orderId: string;
  id: number; // номер події В МЕЖАХ замовлення, що зростає (для SSE id: / Last-Event-ID)
  status: string;
  at: string; // ISO-час
}

// ОДНА шина подій для двох транспортів (WS-gateway і SSE-контролер): Subject + буфер
// останніх подій на кожне замовлення (для реплею пропущеного за Last-Event-ID).
@Injectable()
export class OrderEventsService {
  private readonly subject = new Subject<OrderEvent>();
  private readonly seq = new Map<string, number>(); // per-order лічильник id
  private readonly buffer = new Map<string, OrderEvent[]>(); // per-order кільцевий буфер
  private readonly bufferSize = 100;

  // Публікує подію зміни статусу: нумерує (per-order), кладе в буфер, штовхає в шину.
  publish(orderId: string, status: string): OrderEvent {
    const id = (this.seq.get(orderId) ?? 0) + 1;
    this.seq.set(orderId, id);
    const event: OrderEvent = { orderId, id, status, at: new Date().toISOString() };

    const buf = this.buffer.get(orderId) ?? [];
    buf.push(event);
    if (buf.length > this.bufferSize) buf.shift();
    this.buffer.set(orderId, buf);

    this.subject.next(event);
    return event;
  }

  // Усі події (для gateway — він маршрутизує в кімнати orders:<id>).
  all(): Observable<OrderEvent> {
    return this.subject.asObservable();
  }

  // Потік подій лише одного замовлення (для SSE-підписки).
  stream(orderId: string): Observable<OrderEvent> {
    return this.subject.asObservable().pipe(filter((e) => e.orderId === orderId));
  }

  // Події з id > lastId (реплей пропущеного за Last-Event-ID).
  replaySince(orderId: string, lastId: number): OrderEvent[] {
    return (this.buffer.get(orderId) ?? []).filter((e) => e.id > lastId);
  }
}
