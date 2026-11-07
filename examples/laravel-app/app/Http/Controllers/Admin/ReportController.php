<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Order;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ReportController extends Controller
{
    public function sales(Request $request): JsonResponse
    {
        $from = $request->date('from') ?? now()->startOfMonth();

        $total = Order::where('status', 'paid')->where('created_at', '>=', $from)->sum('total');
        $count = Order::where('status', 'paid')->where('created_at', '>=', $from)->count();

        if ($count === 0) {
            return response()->json(['total' => 0, 'orders' => 0]);
        }

        return response()->json([
            'total' => $total,
            'orders' => $count,
            'average' => $total / $count,
        ]);
    }
}
