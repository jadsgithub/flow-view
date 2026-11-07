<?php

namespace App\Services;

use App\Events\OrderPlaced;
use App\Exceptions\PaymentDeclinedException;
use App\Models\Coupon;
use App\Models\Customer;
use App\Models\Order;
use App\Models\Product;
use Illuminate\Support\Facades\DB;

class OrderService
{
    public function __construct(
        private readonly InventoryService $inventory,
        private readonly PaymentGateway $payments,
    ) {
    }

    /** Cria o pedido dentro de uma transação: estoque, cupom, limite de crédito e cobrança. */
    public function place(Customer $customer, array $items, ?string $coupon = null): Order
    {
        return DB::transaction(function () use ($customer, $items, $coupon) {
            $order = Order::create([
                'customer_id' => $customer->id,
                'status' => 'pending',
                'total' => 0,
            ]);

            $total = 0;

            foreach ($items as $line) {
                $product = Product::lockForUpdate()->findOrFail($line['product_id']);

                $this->inventory->reserve($product, $line['quantity']);

                $order->items()->create([
                    'product_id' => $product->id,
                    'quantity' => $line['quantity'],
                    'unit_price' => $product->price,
                ]);

                $total += $product->price * $line['quantity'];
            }

            if ($coupon !== null) {
                $total = $this->applyCoupon($total, $coupon);
            }

            if ($total > $customer->credit_limit) {
                throw new PaymentDeclinedException('Limite de crédito excedido.');
            }

            $this->payments->charge($customer, $total);

            $order->update(['total' => $total, 'status' => 'paid']);

            OrderPlaced::dispatch($order);

            return $order;
        });
    }

    public function restock(Order $order): void
    {
        foreach ($order->items as $item) {
            $this->inventory->release($item->product, $item->quantity);
        }
    }

    private function applyCoupon(float|int $total, string $code): float|int
    {
        $discount = Coupon::where('code', $code)->where('active', true)->first();

        if (! $discount) {
            return $total;
        }

        return $total * (1 - $discount->percent / 100);
    }
}
