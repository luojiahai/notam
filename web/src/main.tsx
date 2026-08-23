import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

const client = new QueryClient({
	defaultOptions: {
		queries: { refetchOnWindowFocus: false, staleTime: 5_000, retry: 1 },
	},
});

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing from index.html");

createRoot(root).render(
	<StrictMode>
		<QueryClientProvider client={client}>
			<App />
		</QueryClientProvider>
	</StrictMode>,
);
