import React, { useEffect, useState } from 'react';
import { AuthContext } from './AuthContext';
import {
  requestOtpOnPhone,
  verifyOtpFromPhone,
  VerifiedUserResponse,
  RequestOtpResult, //  import the union type
} from '../services/authservices';
import AsyncStorage from '@react-native-async-storage/async-storage';
import EncryptedStorage from 'react-native-encrypted-storage';
import {
  saveLoginSession,
  checkBiometricAuth,
} from '../../../shared/utils/biometricAuth';
import {
  clearDeviceToken,
  registerDeviceToken,
} from '../../../shared/services/notificationService';
import { OneSignal } from 'react-native-onesignal';
import { Alert } from 'react-native';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [otpSent, setOtpSent] = useState<boolean>(false);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [loadingApi, setLoadingApi] = useState<boolean>(false);
  const [loadingAuth, setLoadingAuth] = useState<boolean>(true);
  const [user, setUser] = useState<any>(null);
  const [role, setRole] = useState<string | null>(null);
const [hasLoggedOut, setHasLoggedOut] = useState(false);
const [biometricFailed, setBiometricFailed] = useState(false);
const [biometricLoading, setBiometricLoading] = useState(false);


  // 🔹 Request OTP
  const requestOtp = async (
    phone: string,
    force: boolean = false
  ): Promise<RequestOtpResult | undefined> => {
    try {
      setLoadingApi(true);
      const response = await requestOtpOnPhone(phone, force);
      if (response) {
        setPhoneNumber(phone);
        setOtpSent(true);
        return response; //  valid RequestOtpResponse
      }
    } catch (error: any) {
      if (error.response?.status === 409 && error.response?.data?.conflict) {
        //  cast correctly to ConflictResponse
        return {
          conflict: true as const,
          message: error.response.data.message,
        };
      }
       
      // console.error('Error requesting OTP:', error);
      // Re-throw the error so the calling component can handle it
      throw error;
    } finally {
      setLoadingApi(false);
    }
  };

  // 🔹 Verify OTP
  const verifyOtp = async (otp: string) => {
    if (!phoneNumber) {
      console.error('Missing phoneNumber for OTP verification.');
      return undefined;
    }

    try {
      setLoadingApi(true);
      const response: VerifiedUserResponse | null = await verifyOtpFromPhone(
        phoneNumber,
        otp
      );

      if (response?.token) {
        // Save in AsyncStorage
        await AsyncStorage.setItem('user', JSON.stringify(response.user));
        await AsyncStorage.setItem('token', response.token);
        await AsyncStorage.setItem('role', response.user.role);
        await AsyncStorage.setItem('userId', response.user.id.toString());
        if (response.user.wholesalerId) {
          await AsyncStorage.setItem(
            'wholesalerId',
            response.user.wholesalerId.toString()
          );
        }

        // Save in EncryptedStorage (for biometrics)
        await saveLoginSession(response.token, response.user);

        // Update state
        setUser(response.user);
        setRole(response.user.role);
        setIsAuthenticated(true);

        // 🔹 Register device token after login
        try {
          await registerDeviceToken(Number(response.user.id));
          console.log('Device token registered after OTP verification');
        } catch (err) {
          console.error('Failed to register device token:', err);
        }

        return response;
      }
      return undefined;
    } catch (error) {
      console.error('Error verifying OTP:', error);
      return undefined;
    } finally {
      setLoadingApi(false);
    }
  };

  // 🔹 Load user on mount
useEffect(() => {
  const loadUser = async () => {
    try {
      // 🔹 Only try biometrics if explicitly enabled
      // const biometricEnabled = await EncryptedStorage.getItem("biometricEnabled");

      // if (biometricEnabled === "true") {
      //   const biometricData = await checkBiometricAuth();
      //   if (biometricData) {
      //     const { user } = biometricData;
      //     setUser(user);
      //     setRole(user.role);
      //     setIsAuthenticated(true);
      //     setBiometricFailed(false); // reset
      //     try { await registerDeviceToken(user.id); } catch(e){}
      //     setLoadingAuth(false);
      //     return;
      //   }
      //   // user cancelled → show retry screen
      //   setIsAuthenticated(false);
      //    setBiometricFailed(true);
      //   setLoadingAuth(false);
      //   return;
      // }

      // 🔹 Fallback to AsyncStorage if biometrics not enabled
      const storedUser = await AsyncStorage.getItem('user');
      const storedToken = await AsyncStorage.getItem('token');
      const storedRole = await AsyncStorage.getItem('role');

      if (storedUser && storedToken && storedRole) {
        const parsedUser = JSON.parse(storedUser);
        setUser(parsedUser);
        setRole(storedRole);
        setIsAuthenticated(true);
        try { await registerDeviceToken(parsedUser.id); } catch(e){}
      } else {
        // No session → user must login
        setIsAuthenticated(false);
      }

    } catch (error) {
      console.error('Error loading user:', error);
      setIsAuthenticated(false);
    } finally {
      setLoadingAuth(false);
    }
  };

  loadUser();
}, []);


  // 🔹 Logout
  const logout = async () => {
    try {
      if (user?.id) {
        await clearDeviceToken(user.id);
        console.log('Device token cleared on logout');
      }

      await AsyncStorage.multiRemove([
        'user',
        'token',
        'role',
        'userId',
        'wholesalerId',
      ]);
      await EncryptedStorage.clear();
      await EncryptedStorage.removeItem("biometricEnabled");

      setUser(null);
      setRole(null);
      setIsAuthenticated(false);
      setHasLoggedOut(true);

    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

 const loginWithBiometric = async (): Promise<boolean> => {
  setBiometricLoading(true);
  try {
    const biometricData = await checkBiometricAuth();
    if (!biometricData) {
      setBiometricFailed(true);
      return false;
    }

    setBiometricFailed(false);
    const { user, token } = biometricData;

    await AsyncStorage.setItem("user", JSON.stringify(user));
    await AsyncStorage.setItem("token", token);
    await AsyncStorage.setItem("role", user.role);
    await AsyncStorage.setItem("userId", user.id.toString());
    if (user.wholesalerId) {
      await AsyncStorage.setItem("wholesalerId", user.wholesalerId.toString());
    }
    await saveLoginSession(token, user);

    setUser(user);
    setRole(user.role);
    setIsAuthenticated(true);

    try {
      await registerDeviceToken(user.id);
    } catch (err) {
      console.error("Failed to register device token:", err);
    }

    return true;
  } finally {
    setBiometricLoading(false);
  }
};


  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        phoneNumber,
        otpSent,
        isAuthenticated,
        loadingApi,
        loadingAuth,
        hasLoggedOut,
        biometricFailed,
        biometricLoading,
        requestOtp,
        verifyOtp,
        logout,
        loginWithBiometric,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
