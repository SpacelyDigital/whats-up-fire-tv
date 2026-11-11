#
# Copyright (c) 2025 Amazon.com, Inc. or its affiliates.  All rights reserved.
# PROPRIETARY/CONFIDENTIAL. USE IS SUBJECT TO LICENSE TERMS.
#
cmake_minimum_required(VERSION 3.22)

project(KeepAwake
        VERSION 1.0
        LANGUAGES CXX C)

set(CMAKE_MODULE_PATH ${CMAKE_BINARY_DIR} ${CMAKE_MODULE_PATH})
set(CMAKE_PREFIX_PATH ${CMAKE_BINARY_DIR} ${CMAKE_PREFIX_PATH})

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
# Built files carry no developer paths (the home folder holds the macOS user name).
add_compile_options("-ffile-prefix-map=${CMAKE_SOURCE_DIR}=." "-ffile-prefix-map=$ENV{HOME}=~")

set(HEADERS
  kepler/turbo-modules/KeepAwake.h
)
set(SOURCES
    kepler/turbo-modules/KeepAwake.cpp
    kepler/AutoLinkInit.cpp
)

find_package(Apmf REQUIRED)
find_package(Kepler REQUIRED)
find_package(turbomoduleAPI CONFIG REQUIRED)

kepler_add_idl_import_library(
  idl_pkg
  PACKAGES
  com.amazon.kepler.user_engagement
  # Add additional IDL packages here
)

kepler_add_turbo_module_library(KeepAwake SHARED ${HEADERS} ${SOURCES})

target_link_libraries(KeepAwake PRIVATE idl_pkg)

install(TARGETS KeepAwake)
