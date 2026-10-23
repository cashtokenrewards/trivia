<?php

use Illuminate\Support\Facades\Route;

// Single-page game shell. React handles all in-game navigation.
Route::view('/', 'game');
