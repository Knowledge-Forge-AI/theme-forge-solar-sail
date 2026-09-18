import React, { useState } from "react";
import themeSpec from "@knowledge-forge-ai/app-theme-forge-console";
import { Button } from "./components/ui/button.js";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "./components/ui/card.js";
import { Badge } from "./components/ui/badge.js";
import { Input } from "./components/ui/input.js";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./components/ui/tabs.js";
import "./index.css";

export function App() {
  const [isDark, setIsDark] = useState(false);

  const toggleDark = () => {
    const next = !isDark;
    setIsDark(next);
    if (next) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  return (
    <main className="min-h-screen bg-background text-foreground p-8 flex flex-col items-center justify-center space-y-6">
      <Card id="test-card" className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle id="card-title">Forge Console</CardTitle>
            <Badge id="test-badge">Active</Badge>
          </div>
          <CardDescription>Tailwind CSS v4 and shadcn/ui consumer application</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs defaultValue="general" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            </TabsList>
            <TabsContent value="general" className="space-y-3 pt-2">
              <div>
                <label htmlFor="test-input" className="block text-sm font-medium mb-1">
                  Search or Filter
                </label>
                <Input
                  id="test-input"
                  type="text"
                  placeholder="Type here to test focus ring..."
                />
              </div>
            </TabsContent>
            <TabsContent value="advanced" className="pt-2">
              <p className="text-xs text-muted-foreground">Advanced settings panel.</p>
            </TabsContent>
          </Tabs>
          <div className="flex space-x-3 pt-2">
            <Button id="theme-toggle-btn" onClick={toggleDark}>
              Toggle {isDark ? "Light" : "Dark"}
            </Button>
            <Button id="action-btn" variant="secondary">
              Secondary Action
            </Button>
          </div>
          <div className="pt-2 space-y-2">
            <div
              id="theme-spec-marker"
              className="text-xs text-muted-foreground text-center"
              data-theme-name={themeSpec.name}
              data-theme-version={themeSpec.version}
            >
              Active Theme: {themeSpec.name} v{themeSpec.version}
            </div>
            <div
              id="override-marker"
              className="consumer-custom-override p-3 rounded-md text-sm font-medium text-center"
            >
              Consumer Custom Override Marker
            </div>
            <div
              id="token-override-scope"
              className="consumer-token-override-scope p-3 rounded-md text-sm font-medium text-center border border-border"
            >
              <span className="block text-xs text-muted-foreground mb-2">Cascade Precedence Scope (--primary: #9333ea)</span>
              <Button id="override-token-btn">
                Consumer Token Precedence Button
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}

export default App;
