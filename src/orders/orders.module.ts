import { Module } from '@nestjs/common';
import { ProductsModule } from '../products/products.module';
import { AuthModule } from '../auth/auth.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderEventsService } from './order-events.service';
import { OrdersGateway } from './orders.gateway';

@Module({
  imports: [ProductsModule, AuthModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderEventsService, OrdersGateway],
})
export class OrdersModule {}
