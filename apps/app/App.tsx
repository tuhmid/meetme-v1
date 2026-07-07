// App shell: theme + app state providers around a React Navigation tree.
// No identity → a bare Login stack; signed in (or demo) → Deals/Account tabs.
import { StyleSheet } from 'react-native';
import { DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ThemeProvider, useTheme } from './src/theme';
import { UIGallery } from './src/ui';
import { AppProvider, useApp } from './src/app/AppContext';
import { navigationRef, type AuthStackParamList, type DealsStackParamList, type MainTabsParamList } from './src/app/nav';
import LoginScreen from './src/app/screens/LoginScreen';
import HomeScreen from './src/app/screens/HomeScreen';
import DealScreen from './src/app/screens/DealScreen';
import AccountScreen from './src/app/screens/AccountScreen';

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const DealsStack = createNativeStackNavigator<DealsStackParamList>();
const Tabs = createBottomTabNavigator<MainTabsParamList>();

function DealsStackScreen() {
  return (
    <DealsStack.Navigator screenOptions={{ headerShown: false }}>
      <DealsStack.Screen name="Home" component={HomeScreen} />
      <DealsStack.Screen name="Deal" component={DealScreen} options={{ gestureEnabled: true }} />
    </DealsStack.Navigator>
  );
}

function MainTabs() {
  const theme = useTheme();
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarStyle: { backgroundColor: theme.colors.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border },
      }}
    >
      <Tabs.Screen
        name="DealsTab"
        component={DealsStackScreen}
        options={{ tabBarLabel: 'Deals', tabBarIcon: ({ color, size }) => <Ionicons name="swap-horizontal" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="AccountTab"
        component={AccountScreen}
        options={{ tabBarLabel: 'Account', tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" size={size} color={color} /> }}
      />
    </Tabs.Navigator>
  );
}

function RootNavigator() {
  const theme = useTheme();
  const { session, demo } = useApp();
  // match the navigator background to the app theme so screen transitions never flash white
  const navTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      primary: theme.colors.primary,
      background: theme.colors.bg,
      card: theme.colors.surface,
      text: theme.colors.text,
      border: theme.colors.border,
    },
  };
  return (
    <NavigationContainer ref={navigationRef} theme={navTheme}>
      {!session && !demo ? (
        <AuthStack.Navigator screenOptions={{ headerShown: false }}>
          <AuthStack.Screen name="Login" component={LoginScreen} />
        </AuthStack.Navigator>
      ) : (
        <MainTabs />
      )}
    </NavigationContainer>
  );
}

// Dev switch: render the UI-kit gallery instead of the app (design review only).
const SHOW_UI_GALLERY = false;

export default function App() {
  return (
    <ThemeProvider>
      {SHOW_UI_GALLERY ? (
        <UIGallery />
      ) : (
        <SafeAreaProvider>
          <AppProvider>
            <RootNavigator />
          </AppProvider>
        </SafeAreaProvider>
      )}
    </ThemeProvider>
  );
}
