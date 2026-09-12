import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Check,
} from 'typeorm';
import { Order } from './order.entity';

// tasks: черга post-processing задач (лист/чек). Воркери розбирають її через
// SELECT ... FOR UPDATE SKIP LOCKED. processed — лічильник обробок (має бути рівно 1).
@Entity('tasks')
@Check('CHK_tasks_status', `"status" IN ('pending','done')`)
// partial-індекс під чергу: воркер шукає лише pending, у порядку появи
@Index('tasks_pending_idx', ['createdAt'], { where: `status = 'pending'` })
export class Task {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id: string;

  @Column({ type: 'bigint', name: 'order_id' })
  orderId: string;

  // задача належить замовленню й гине разом із ним → CASCADE
  @ManyToOne(() => Order, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @Column({ type: 'text', default: 'email' })
  kind: string;

  @Column({ type: 'text', default: 'pending' })
  status: string;

  // скільки разів задачу обробили; чесний воркер-пул тримає це = 1
  @Column({ type: 'int', default: 0 })
  processed: number;

  @Column({ type: 'text', name: 'locked_by', nullable: true })
  lockedBy: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
