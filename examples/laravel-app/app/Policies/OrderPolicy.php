<?php

namespace App\Policies;

use App\Models\Order;
use App\Models\User;

class OrderPolicy
{
    public function create(User $user): bool
    {
        return $user->is_active;
    }

    public function delete(User $user, Order $order): bool
    {
        return $user->id === $order->customer_id && $order->status === 'pending';
    }

    public function cancel(User $user, Order $order): bool
    {
        return $user->id === $order->customer_id && $order->status !== 'cancelled';
    }
}
