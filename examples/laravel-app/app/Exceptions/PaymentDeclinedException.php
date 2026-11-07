<?php

namespace App\Exceptions;

use Exception;

class PaymentDeclinedException extends Exception
{
    public function render()
    {
        return response()->json(['message' => $this->getMessage()], 402);
    }
}
