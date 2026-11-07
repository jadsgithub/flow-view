<?php

namespace App\Exceptions;

use Exception;

class InsufficientStockException extends Exception
{
    public function __construct(string $product, int $requested)
    {
        parent::__construct("Estoque insuficiente de {$product} para {$requested} unidade(s).");
    }

    public function render()
    {
        return response()->json(['message' => $this->getMessage()], 409);
    }
}
