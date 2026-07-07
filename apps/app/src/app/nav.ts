// Navigation ref + tiny imperative helpers so context handlers can move
// between screens without holding a `navigation` prop.
import { createNavigationContainerRef, type NavigatorScreenParams } from '@react-navigation/native';

export type DealsStackParamList = {
  Home: undefined;
  Deal: undefined;
};

export type MainTabsParamList = {
  DealsTab: NavigatorScreenParams<DealsStackParamList>;
  AccountTab: undefined;
};

export type AuthStackParamList = {
  Login: undefined;
};

// The container renders either the auth stack or the tabs, so the ref sees both.
export type RootParamList = AuthStackParamList & MainTabsParamList;

export const navigationRef = createNavigationContainerRef<RootParamList>();

// Back to the deals list (pops the Deal screen if it's open).
export const goHome = () => {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('DealsTab', { screen: 'Home' });
};

// Push the deal screen for whatever dealId is currently set in context.
export const goDeal = () => {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate('DealsTab', { screen: 'Deal' });
};
