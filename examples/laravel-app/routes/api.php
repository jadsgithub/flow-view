<?php

use App\Http\Controllers\Admin\ReportController;
use App\Http\Controllers\OrderController;
use App\Http\Controllers\PingController;
use Illuminate\Support\Facades\Route;

Route::get('/ping', PingController::class);

Route::middleware(['auth:sanctum', 'throttle:60,1'])->group(function () {
    Route::apiResource('orders', OrderController::class);

    Route::post('orders/{order}/cancel', [OrderController::class, 'cancel'])
        ->middleware('can:cancel,order')
        ->name('orders.cancel');

    Route::prefix('admin')->middleware(['active', 'role:admin'])->name('admin.')->group(function () {
        Route::get('reports/sales', [ReportController::class, 'sales'])->name('reports.sales');
    });
});

Route::get('/health', fn () => response()->json(['status' => 'ok']));
