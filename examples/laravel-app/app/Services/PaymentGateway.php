<?php

namespace App\Services;

use App\Exceptions\PaymentDeclinedException;
use App\Models\Customer;
use Illuminate\Support\Facades\Http;

class PaymentGateway
{
    public function charge(Customer $customer, float|int $amount): array
    {
        $response = Http::withToken(config('services.payments.token'))
            ->timeout(10)
            ->post('https://api.payments.example.com/v1/charges', [
                'customer' => $customer->payment_id,
                'amount' => (int) round($amount * 100),
            ]);

        if ($response->failed()) {
            throw new PaymentDeclinedException('Pagamento recusado pela operadora.');
        }

        return $response->json();
    }
}
