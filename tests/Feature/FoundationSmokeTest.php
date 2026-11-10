<?php

namespace Tests\Feature;

use Tests\TestCase;

class FoundationSmokeTest extends TestCase
{
    public function test_game_shell_renders_the_react_root(): void
    {
        $this->get('/')
            ->assertOk()
            ->assertSee('id="root"', false);
    }

    public function test_health_endpoint_returns_ok_without_secrets(): void
    {
        $response = $this->getJson('/api/health')
            ->assertOk()
            ->assertJsonStructure(['status', 'app', 'time'])
            ->assertJsonPath('status', 'ok');

        $this->assertStringNotContainsString(
            (string) config('app.key'),
            $response->getContent(),
        );
    }
}
