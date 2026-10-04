import { createContext, useContext, type ReactNode } from "react";
import type { Feedback } from "./feedback";

const FeedbackContext = createContext<Feedback | null>(null);

export function FeedbackProvider({ value, children }: { value: Feedback; children: ReactNode }) {
  return <FeedbackContext.Provider value={value}>{children}</FeedbackContext.Provider>;
}

export function useFeedback(): Feedback {
  const feedback = useContext(FeedbackContext);
  if (!feedback) throw new Error("FeedbackProvider is missing");
  return feedback;
}
