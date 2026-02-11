"use client";

import { createContext, useContext, useState, ReactNode } from "react";

interface UserContextType {
  username: string;
  setUsername: (v: string) => void;
  queriedUser: string;
  setQueriedUser: (v: string) => void;
  searchTrigger: number;
  triggerSearch: () => void;
}

const UserContext = createContext<UserContextType | null>(null);

export function UserProvider({ children }: { children: ReactNode }) {
  const [username, setUsername] = useState("");
  const [queriedUser, setQueriedUser] = useState("");
  const [searchTrigger, setSearchTrigger] = useState(0);

  function triggerSearch() {
    const trimmed = username.trim();
    if (!trimmed) return;
    setQueriedUser(trimmed);
    setSearchTrigger((n) => n + 1);
  }

  return (
    <UserContext.Provider
      value={{
        username,
        setUsername,
        queriedUser,
        setQueriedUser,
        searchTrigger,
        triggerSearch,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useUserContext() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUserContext must be used within UserProvider");
  return ctx;
}
