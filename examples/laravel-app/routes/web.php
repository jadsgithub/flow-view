<?php

use App\Models\Order;
use Illuminate\Support\Facades\Route;

Route::view('/', 'welcome');

Route::get('/orders/{order}/receipt', function (Order $order) {
    if ($order->status !== 'paid') {
        abort(404);
    }

    return view('orders.receipt', ['order' => $order]);
})->middleware('auth')->name('orders.receipt');
