<?php

namespace App\Http\Controllers;

use App\Exceptions\InsufficientStockException;
use App\Exceptions\PaymentDeclinedException;
use App\Http\Requests\StoreOrderRequest;
use App\Http\Requests\UpdateOrderRequest;
use App\Http\Resources\OrderResource;
use App\Models\Customer;
use App\Models\Order;
use App\Services\OrderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class OrderController extends Controller
{
    public function __construct(private readonly OrderService $orders)
    {
    }

    /** Lista os pedidos do usuário logado. */
    public function index(Request $request)
    {
        $status = $request->query('status');

        $orders = Order::query()
            ->with('items')
            ->where('customer_id', $request->user()->id)
            ->latest()
            ->paginate(15);

        return OrderResource::collection($orders);
    }

    /** Cria um pedido: valida, reserva estoque, cobra e dispara o evento. */
    public function store(StoreOrderRequest $request): JsonResponse
    {
        $data = $request->validated();

        $customer = Customer::findOrFail($data['customer_id']);

        if ($customer->blocked) {
            return response()->json(['message' => 'Cliente bloqueado.'], 422);
        }

        try {
            $order = $this->orders->place($customer, $data['items'], $data['coupon'] ?? null);
        } catch (InsufficientStockException $e) {
            return response()->json(['message' => $e->getMessage()], 409);
        } catch (PaymentDeclinedException $e) {
            Log::warning('Pagamento recusado', ['customer' => $customer->id]);

            return response()->json(['message' => 'Pagamento recusado.'], 402);
        }

        return (new OrderResource($order))->response()->setStatusCode(201);
    }

    public function show(Order $order)
    {
        $order->load('items');

        return new OrderResource($order);
    }

    public function update(UpdateOrderRequest $request, Order $order)
    {
        if ($order->status !== 'pending') {
            abort(409, 'Só pedidos pendentes podem ser alterados.');
        }

        $order->update($request->validated());

        return new OrderResource($order->fresh());
    }

    public function destroy(Order $order)
    {
        $this->authorize('delete', $order);

        $order->delete();

        return response()->noContent();
    }

    public function cancel(Request $request, Order $order)
    {
        $reason = $request->input('reason', 'sem motivo informado');

        DB::transaction(function () use ($order, $reason) {
            $this->orders->restock($order);
            $order->update(['status' => 'cancelled', 'cancel_reason' => $reason]);
        });

        return response()->json(['message' => 'Pedido cancelado.', 'status' => $order->status]);
    }
}
