<?php

namespace App\Http\Controllers;

class PingController extends Controller
{
    public function __invoke()
    {
        return response()->json(['pong' => true]);
    }
}
