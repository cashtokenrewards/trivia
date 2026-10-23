<?php

use Illuminate\Support\Facades\Route;

// Public health check. Must never expose secrets or configuration values.
Route::get('/health', fn () => response()->json([
    'status' => 'ok',
    'app' => 'cashtoken-trivia',
    'time' => now()->utc()->format('Y-m-d\TH:i:s.v\Z'),
]))->middleware('throttle:60,1');
