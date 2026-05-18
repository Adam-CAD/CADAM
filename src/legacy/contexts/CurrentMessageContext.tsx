import { Message } from '@shared/types';
import { createContext, useContext } from 'react';

type CurrentMessageContextType = {
  currentMessage: Message | null;
  setCurrentMessage: (message: Message | null) => void;
};

export const CurrentMessageContext = createContext<CurrentMessageContextType>({
  currentMessage: null,
  setCurrentMessage: () => {},
});

export const useCurrentMessage = () => {
  const context = useContext(CurrentMessageContext);
  if (!context) {
    throw new Error(
      'useCurrentMessage must be used within a CurrentMessageProvider',
    );
  }
  return context;
};
