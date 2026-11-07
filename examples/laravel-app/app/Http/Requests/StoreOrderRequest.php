<?php

namespace App\Http\Requests;

use App\Models\Order;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreOrderRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()->can('create', Order::class);
    }

    protected function prepareForValidation(): void
    {
        $this->merge([
            'coupon' => $this->coupon ? strtoupper(trim($this->coupon)) : null,
        ]);
    }

    public function rules(): array
    {
        return [
            'customer_id' => ['required', 'integer', 'exists:customers,id'],
            'items' => ['required', 'array', 'min:1'],
            'items.*.product_id' => ['required', 'integer', Rule::exists('products', 'id')],
            'items.*.quantity' => ['required', 'integer', 'min:1', 'max:100'],
            'coupon' => ['nullable', 'string', 'max:20'],
            'notes' => 'nullable|string|max:500',
        ];
    }

    public function messages(): array
    {
        return [
            'items.required' => 'Informe ao menos um item.',
            'items.*.quantity.max' => 'Quantidade máxima por item: 100.',
        ];
    }
}
