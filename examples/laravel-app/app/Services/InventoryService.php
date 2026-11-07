<?php

namespace App\Services;

use App\Exceptions\InsufficientStockException;
use App\Models\Product;

class InventoryService
{
    public function reserve(Product $product, int $quantity): void
    {
        if ($product->stock < $quantity) {
            throw new InsufficientStockException($product->name, $quantity);
        }

        $product->decrement('stock', $quantity);
    }

    public function release(Product $product, int $quantity): void
    {
        $product->increment('stock', $quantity);
    }
}
