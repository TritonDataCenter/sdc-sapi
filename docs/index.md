---
title: Services API
apisections: Service Configuration, Amon Configuration, Applications, Services, Instances, Manifests, Images, Modes, Configs, Cache
markdown2extras: tables, code-friendly
---

<!--
    This Source Code Form is subject to the terms of the Mozilla Public
    License, v. 2.0. If a copy of the MPL was not distributed with this
    file, You can obtain one at http://mozilla.org/MPL/2.0/.
-->

<!--
    Copyright 2021 Joyent, Inc.
    Copyright 2022 MNX Cloud, Inc.
-->

<!-- markdownlint-disable MD024 -->

# Services API

This API allows operators to configure, deploy, and upgrade software using a
set of loosely-coupled federated services.

It has several goals:

* Provide clean, unified deployment semantics
* Enable auto-discovery of SDC and manta services
* Enable dynamic configuration of SDC and manta services
* Provide an API for an operator portal

## Overview

SAPI has two main components: the API itself and the associated config-agent.
There's also a SAPI client delivered with the rest of the SDC clients.

### SAPI

Each datacenter has a single SAPI zone.  That zone is stateless and writes
objects into its datacenter's moray database.  In addition to storing its
objects in moray, it also communicates with VMAPI to provision zones and NAPI
to reserve NICs and lookup network UUIDs.

SAPI contains three main object types: applications, services, and instances.
An application has one or more services and a service has one or more instances.
Instances represent actual zones, and those zones inherit their zone parameters
and metadata from the associated applications and services.

Every application, service, and instance has three sets of properties:

* `params` - Zone parameters like a zone's RAM size, disk quota, image_uuid,
  etc.  These parameters are evaluated when a zone is provisioned.  If they're
  updated after a zone has been created, a zone will not receive the updated
  params.

* `metadata` - Zone metadata made available to the config-agent.  These metadata
  keys and values form the input to the hogan.js template in the configuration
  manifest (described below).  As these values are updated, the config-agent
  will rewrite any configuration will make reference to changed metadata
  values.

* `manifests` - A set of configuration manifests (see the Configuration Agent
  section for description of what's in each manifest).  These manifests are
  indexed by name to faciliate inheriting manifest from parent objects.

Creating applications and service have no effect on running zones.  When an
instance is created, a zone is provisioned using the above information from its
associated application, service, and instance.

### Example Usage

For example, given this application (some fields omitted for clarity):

    {
      "params": {
        "ram": 256,
        "quota": 10
      },
      "metadata": {
         "MORAY": "1.moray.manta.joyent.us"
      },
      "manifests": {
        "registrar": "76e51922-808b-11e2-af4e-bb62bca39c7f"
      }
    }

this service:

    {
      "params": {
        "quota": 0  // no quota
      },
      "metadata": {
         "NGINX_WORKERS": 8
      },
      "manifests": {
        "mako": "9968efc8-808b-11e2-ae99-9fb2d8f3fdff"
      }
    }

and this instance:

    {
      "params": {
        "delegate_dataset": true
      },
      "metadata": {
         "DATA_DIR": "/manta",
         "MORAY": "2.moray.manta.joyent.us"
      },
      "manifests": {
        "mako": "cc3f2584-808b-11e2-85de-1796a075e6f7",
        "minnow": "c58f9dda-808c-11e2-b818-6ba0930bad61"
      }
    }

The resulting zone would have the following zone parameters passed to
VMAPI.createVm():

    {
      "ram": 256,
      "quota": 0,
      "delegate_dataset": true
    }

That zone would have the following metadata:

    {
      "NGINX_WORKERS": 8,
      "DATA_DIR": "/manta",
      "MORAY": "2.moray.manta.joyent.us"
    }

Finally, that zone would use the following configuration manifests:

    {
      "registrar": "76e51922-808b-11e2-af4e-bb62bca39c7f",
      "mako": cc3f2584-808b-11e2-85de-1796a075e6f7",
      "minnow": "c58f9dda-808c-11e2-b818-6ba0930bad61"
    }

The configuration manifests would be processed by the config-agent, as described
below.

### Configuration Agent

Each zone deployed with SAPI contains an agent which is responsible for
maintaining configuration inside that zone.  The config-agent queries SAPI
directly to determine which files to write and where to write them.  The agent
uses objects called configuration manifests; those objects describe the
contents, location, and semantics of configuration files for a zone.

Those manifests contain a hogan.js template which is rendered using the metadata
from the associated application, service, and instance.  Here's an example
configuration manifest:

    {
      "path": "/opt/smartdc/minnow/etc/config.json"
      "post_cmd": "svcadm refresh minnow",
      "template": {
        "moray": {
          "bucket": {
            "name": "manta_storage",
            "index": {
              "hostname": { "type": "string" },
              "availableMB": { "type": "number" },
              "percentUsed": { "type": "number" },
              "server_uuid": { "type": "string" },
              "timestamp": { "type": "number" },
              "zone_uuid": { "type": "string" }
            }
          },
          "connectTimeout": 200,
          "retry": {
            "retries": 2,
            "minTimeout": 500
          },
          "host": "{{MORAY}}",
          "port": 2020
        },
        "objectRoot": "{{DATA_DIR}}",
        "interval": 5000
      }
    }

Combined with the metadata from the above example, the config-agent would write
this file into /opt/smartdc/minnow/etc/config.json and then refresh the minnow
SMF service.

    {
      "moray" {
        "bucket": {
          "name": "manta_storage",
          "index": {
            "hostname": { "type": "string" },
            "availableMB": { "type": "number" },
            "percentUsed": { "type": "number" },
            "server_uuid": { "type": "string" },
            "timestamp": { "type": "number" },
            "zone_uuid": { "type": "string" }
          }
        },
        "connectTimeout": 200,
        "retry": {
          "retries": 2,
          "minTimeout": 500
        },
        "host": "2.moray.manta.joyent.us",
        "port": 2020
      },
      "objectRoot": "/manta",
      "interval": 5000
    }

## Proto Mode

SAPI has two modes: proto and full mode.  Full mode is the normal operation
covered by other sections in this document.

In proto mode, SAPI has no connections to its downstream services (mainly moray,
VMAPI, NAPI, and IMGAPI).  In that mode, any applications, services, and
instances created are stored in files in the SAPI zone.  Since there are no
downstream services available, there are some limitations on what SAPI can do in
proto mode:

* The SearchImage and DownloadImage endpoints are not available.
* SAPI cannot verify that an image_uuid is valid.
* SAPI cannot provision zones when an instance is created.
* SAPI cannot remove zones when an instance is destroyed.

The SetMode endpoint allows an operator to dynamically upgrade from proto to
full mode.  That upgrade iterates over all the local object and loads them into
moray.  For any local instance objects, it is expected that a zone already
exists for each instance object -- specifically, a VMAPI.getVm() must succeed
for each local instance.  Should VMAPI not know about any instance, the SetMode
request will fail.  In addition, SetMode does not verify the
image_uuid; the expectation is that the operator used correct values while in
proto mode.

Once SAPI is in full mode, downgrading to proto mode is not supported.

## Applications

### Application Schema Validation

An application may have a schema associated with it which covers its metadata or
some portion of it. A schema is described based on [JSON
Schema](http://json-schema.org/). A schema may be provided at creation time or
when updating an application. The following rules govern how metadata is checked
against its schema:

* If a schema is provided as part of CreateApplication and the metadata does not
  match it, the create will fail.

* If an application has a schema and the metadata is updated, the new metadata
  must match that schema, or the update will fail.

* If an update is being made that modifies the schema, whether adding or
  modifying it, then if the existing metadata does not match the new schema,
  then the update will fail.

* If an update is being made that modifies both the schema and the metadata,
  only the new metadata is checked against the new schema. If it matches the
  schema, then it will pass.

As part of putting together a schema, one should carefully consider whether or
not fields that are not a part of the schema are allowed. One challenge around
having a strict schema is that it makes it harder to cross flag days where the
set of valid fields in the schema change. In addition, one must consider that
historically many of the applications have no schema associated with them, and
therefore we need to move slowly to allow SAPI applications to be updated.

#### Schema Checking Limitations

At this time, we only support and validate a schema for the metadata of an
application. Instances and services can override that metadata; however, those
changes are not checked against it at this time. In the future, we would like to
allow a service or instance to override or add additions to the schema such that
this checking can be extended to all services and instances.

### CreateApplication (POST /applications)

Creates a new application.  An application must have a name and an
owner_uuid.  If an application specifies any schema for it's metadata, the
metadata must honor that schema.

#### Inputs

| Param           | Type           | Description                    | Required? |
| --------------- | -------------- | ------------------------------ | --------- |
| name            | string         | Name of application            | yes       |
| owner_uuid      | UUID           | Owner's UUID                   | yes       |
| params          | object         | zones's parameters             | no        |
| metadata        | object         | zone's metadata                | no        |
| metadata_schema | object         | validation schema for metadata | no        |
| manifests       | array of UUIDs | configuration manifests        | no        |

#### Responses

| Code | Description                      | Response                       |
| ---- | -------------------------------- | ------------------------------ |
| 204  | Application successfully created | Application object             |
| 409  | Conflict Detected                | Metadata does not match schema |

#### Example

    POST /applications -d '{
      "name": "sdc",
      "owner_uuid": "930896af-bf8c-48d4-885c-6573a94b1853",
      "params" {
        "delegate_dataset": true
      }
    }'

### ListApplications (GET /applications)

Returns a list of all applications.

#### Inputs

| Param      | Type   | Description         | Required? |
| ---------- | ------ | ------------------- | --------- |
| name       | string | Name of application | no        |
| owner_uuid | UUID   | Owner's UUID        | no        |

#### Responses

| Code | Description                    | Response                    |
| ---- | ------------------------------ | --------------------------- |
| 200  | Found one or more applications | List of application objects |
| 404  | No applications found          | none                        |

#### Example

    GET /applications?name=manta
    [
      {
        "uuid": "14160e92-5533-11e2-86a2-9f78cf99260d",
        "name": "sdc",
        "owner_uuid": "1959d690-5533-11e2-8bee-1b98757172d1",
        "params": {
          "ram": 1024,
          "quota": 100
        },
        "metadata": {
          "NAMESERVERS": [ "10.99.99.20", "10.99.99.21" ],
          "REGION": "sf"
        },
        "manifests": {
          "dns_client": "e0ebe2ac-8a30-49e2-b1a6-4cc9d763f3e1"
        }
      }
    ]

### GetApplication (GET /applications/:uuid)

Get an application by UUID.

#### Inputs

| Param | Type | Description         | Required? |
| ----- | ---- | ------------------- | --------- |
| uuid  | UUID | UUID of application | yes       |

#### Responses

| Code | Description           | Response           |
| ---- | --------------------- | ------------------ |
| 200  | Application found     | Application object |
| 404  | No applications found | none               |

#### Example

See the example for ListApplications above.

### UpdateApplication (PUT /applications/:uuid)

Updates an application.

#### Inputs

| Param           | Type           | Description                                              | Required? |
| --------------- | -------------- | -------------------------------------------------------- | --------- |
| uuid            | UUID           | UUID of application                                      | yes       |
| action          | string         | One of 'update', 'replace', 'delete'. Default is update. | no        |
| params          | object         | zone parameters                                          | no        |
| metadata        | object         | zone metadata                                            | no        |
| metadata_schema | object         | schema for the zone metadata                             | no        |
| manifests       | array of UUIDs | configuration manifests                                  | no        |
| owner_uuid      | UUID           | application's new owner                                  | no        |

#### Responses

| Code | Description          | Response                       |
| ---- | -------------------- | ------------------------------ |
| 200  | Updates completed    | Updated application object     |
| 404  | No application found | none                           |
| 409  | Conflict Detected    | Metadata does not match schema |

#### Example

    PUT /applications/b0d2f944-7fa3-11e2-a53c-3f3c7a8e7341 -d '{
      "action": "update",
      "metadata" {
        "domain": "lab.joyent.dev"
      }
    }'

### DeleteApplication (DELETE /application/:uuid)

Deletes an application.

#### Inputs

| Param | Type | Description         | Required? |
| ----- | ---- | ------------------- | --------- |
| uuid  | UUID | UUID of application | yes       |

#### Responses

| Code | Description             | Response |
| ---- | ----------------------- | -------- |
| 204  | Application was deleted | none     |

## Services

### CreateService (POST /services)

Create a service.

#### Inputs

| Param            | Type           | Description             | Required? |
| ---------------- | -------------- | ----------------------- | --------- |
| name             | string         | Name of service         | yes       |
| application_uuid | UUID           | Application's UUID      | yes       |
| params           | object         | zone parameters         | no        |
| metadata         | object         | zone metadata           | no        |
| manifests        | array of UUIDs | configuration manifests | no        |

### ListServices (GET /services)

Returns the list of all services.

| Param            | Type   | Description        | Required? |
| ---------------- | ------ | ------------------ | --------- |
| name             | string | Name of service    | no        |
| application_uuid | UUID   | Application's UUID | no        |

#### Responses

| Code | Description                | Response                |
| ---- | -------------------------- | ----------------------- |
| 200  | Found one or more services | List of service objects |
| 404  | No services found          | none                    |

#### Example

    GET /services?name=storage
    [
      {
        "uuid": "09a5da9f-db2a-42d8-99ac-1263cc5751b2",
        "name": "storage",
        "application_uuid": "df065006-2d4c-422d-92f0-091b9f9e443a",
        "params": {
          "image_uuid": "cbd1b029-54ab-4864-b792-9c6fe615dcd6"
        },
        "metadata": {
          "NGINX_WORKERS": 8
        }
        "manifests": {
          "mako": "b9cb33dd-6610-44c9-9c7d-9e4ce8dd8af3",
          "minnow": "ed29bb94-34bd-410a-97cc-a750bce147cd"
        }
      }
    ]

### GetService (GET /services/:uuid)

Return a particular service.

#### Inputs

| Param | Type | Description     | Required? |
| ----- | ---- | --------------- | --------- |
| uuid  | UUID | UUID of service | yes       |

#### Responses

| Code | Description      | Response       |
| ---- | ---------------- | -------------- |
| 200  | Service found    | Service object |
| 404  | No service found | none           |

#### Example

See the example for ListServices above.

### UpdateService (PUT /services/:uuid)

Updates an service.

#### Inputs

| Param     | Type           | Description                                              | Required? |
| --------- | -------------- | -------------------------------------------------------- | --------- |
| uuid      | UUID           | UUID of service                                          | yes       |
| action    | string         | One of 'update', 'replace', 'delete'. Default is update. | no        |
| params    | object         | zone parameters                                          | no        |
| metadata  | object         | zone metadata                                            | no        |
| manifests | array of UUIDs | configuration manifests                                  | no        |

#### Responses

| Code | Description       | Response               |
| ---- | ----------------- | ---------------------- |
| 200  | Updates completed | Updated service object |
| 404  | No service found  | none                   |

#### Example

    PUT /services/09a5da9f-db2a-42d8-99ac-1263cc5751b2 -d '{
      "action": "update",
      "metadata" {
        "NGINX_WORKERS": 32
      }
    }'

### DeleteService (DELETE /services/:uuid)

Delete a particular service.

#### Inputs

| Param | Type | Description     | Required? |
| ----- | ---- | --------------- | --------- |
| uuid  | UUID | UUID of service | yes       |

#### Responses

| Code | Description         | Response |
| ---- | ------------------- | -------- |
| 204  | Service was deleted | none     |

## Instances

### CreateInstance (POST /instances)

Create and deploy an instance.

#### Inputs

| Param        | Type           | Description                      | Required? |
| ------------ | -------------- | -------------------------------- | --------- |
| service_uuid | UUID           | Service's UUID                   | yes       |
| uuid         | UUID           | UUID to use for the new instance | no        |
| params       | object         | zone parameters                  | no        |
| metadata     | object         | zone metadata                    | no        |
| manifests    | array of UUIDs | configuration manifests          | no        |

#### Responses

| Code | Description                   | Response        |
| ---- | ----------------------------- | --------------- |
| 204  | Instance successfully created | Instance object |

#### Example

    POST /instances -d '{
      "name": "sdc",
      "owner_uuid": "930896af-bf8c-48d4-885c-6573a94b1853",
      "params" {
        "delegate_dataset": true
      }
    }'

#### Customer metadata

By default, SAPI removes all keys from the `customer_metadata` parameters
passed to VMAPI for zone creation, other than the following:

* *SAPI_URL
* *sapi_url
* *SAPI-URL
* *sapi-url
* *user-script
* *assets-ip

To allow other customer metadata keys to be passed to VMAPI, set the
`pass_vmapi_metadata_keys` array in the `metadata` object, as in this example,
where `com.joyent:ipnat_subnet` will be added to the VMAPI VM object's
customer metadata:

    POST /instances -d '{
      "name": "nat",
      "owner_uuid": "930896af-bf8c-48d4-885c-6573a94b1853",
      "metadata" {
        "pass_vmapi_metadata_keys": [ "com.joyent:ipnat_subnet" ],
        "com.joyent:ipnat_subnet": "192.168.42.1/24"
      }
    }'

### CreateInstanceAsync (POST /instances?async=true)

Create and deploy an instance asynchronously. This accepts the same parameters
as [CreateInstance](#CreateInstance), but does not wait to return the final
created instance object. It instead returns th

#### Inputs

See [CreateInstance](#CreateInstance) above.

#### Responses

See [CreateInstance](#CreateInstance) above.  The created instance object has
one additional field: `job_uuid`, which is the
[Workflow API](https://github.com/TritonDataCenter/sdc-workflow) job for the created
instance.

#### Example

    POST /instances?async=true -d '{
      "name": "sdc",
      "owner_uuid": "930896af-bf8c-48d4-885c-6573a94b1853",
      "params" {
        "delegate_dataset": true
      }
    }'

### AdoptInstance (POST /instances)

Existing instances can be added to SAPI by adding `"exists": true` to the
payload given to [CreateInstance](#CreateInstance). In this case, the `uuid`
of the instance to be adopted is *mandatory*, not optional.

When SAPI isn't in [Proto Mode](#proto-mode), the existence of the provided
instance `uuid` will be verified through `VMAPI`. In case the instance cannot
be found, an `Invalid Argument` error will be returned (`409` Status Code).

#### Inputs

See [CreateInstance](#CreateInstance) above.

#### Responses

See [CreateInstance](#CreateInstance) above.

#### Example

    POST /instances -d '{
      "name": "papi",
      "service_uuid": "161f70c5-e18c-448e-bb33-a04142bfe5ea",
      "params" {
        "alias": "papi2"
      },
      "exists": true
    }'

### ListInstances (GET /instances)

List all instances, with an optional service_uuid filter.

#### Inputs

| Param        | Type | Description               | Required? |
| ------------ | ---- | ------------------------- | --------- |
| service_uuid | UUID | service_uuid to filter by | no        |

#### Responses

| Code | Description                                    | Response                                   |
| ---- | ---------------------------------------------- | ------------------------------------------ |
| 200  | All instances, or instances which match filter | Array of instance objects (possibly empty) |

Note that in the case that no instances match the service_uuid filter, this
endpoint will still return 200, only with an empty array.

If additional filters beyond service_uuid are required, they must be implemented
on the client side.

#### Example

    GET /instances?service_uuid=5081a5d6-6bd0-11e2-bafb-a735b6c6ccb6
    [
      {
        "uuid": "b63c3b56-6bd1-11e2-af0a-836066bbb42e",
        "service_uuid": "5081a5d6-6bd0-11e2-bafb-a735b6c6ccb6",  // "mako"
        "params": {
          ram: 4096
        },
        "metadata": {
          "MORAY": "1.moray.manta.joyent.us"
        },
        "manifests": [ ]
      },
      ...
    ]

### GetInstance (GET /instances/:uuid)

Get a particular instance by UUID.

#### Inputs

| Param | Type | Description      | Required? |
| ----- | ---- | ---------------- | --------- |
| uuid  | UUID | UUID of instance | yes       |

#### Responses

| Code | Description        | Response        |
| ---- | ------------------ | --------------- |
| 200  | Instance found     | Instance object |
| 404  | Instance not found | none            |

#### Example

    GET /instances/b63c3b56-6bd1-11e2-af0a-836066bbb42e
    {
      "uuid": "b63c3b56-6bd1-11e2-af0a-836066bbb42e",
      "service_uuid": "5081a5d6-6bd0-11e2-bafb-a735b6c6ccb6",  // "mako"
      "params": {
        ram: 4096
      },
      "metadata": {
        "MORAY": "1.moray.manta.joyent.us"
      },
      "manifests": [ ]
    }

### GetInstancePayload (GET /instances/:uuid/payload)

Get the actual payload passed to VMAPI.createVm() for this instance.

#### Inputs

| Param | Type | Description      | Required? |
| ----- | ---- | ---------------- | --------- |
| uuid  | UUID | UUID of instance | yes       |

#### Responses

| Code | Description                          | Response       |
| ---- | ------------------------------------ | -------------- |
| 200  | Payload provided to VMAPI.createVm() | Payload object |
| 404  | Instance not found                   | none           |

#### Example

    GET instances/18e7dbc9-0f2b-421b-ba39-d1701c55a1f5/payload
    {
      "delegate_dataset": true,
      "image_uuid": "e32e839b-4955-4332-b489-65d70debfaa4",
      "ram": 2048,
      "owner_uuid": "a6ef45d3-580d-49a2-adfa-0abb20579574",
      "uuid": "18e7dbc9-0f2b-421b-ba39-d1701c55a1f5",
      "brand": "joyent-minimal",
      "server_uuid": "44454c4c-4800-1034-804a-b2c04f354d31",
      "customer_metadata": {
        "ufds_admin_ip": "ldaps://10.2.206.10",
        "ufds_url": "ldaps://10.2.206.10",
        "service_port": 80,
        ....
      }
    }

### UpdateInstance (PUT /instances/:uuid)

Updates an instance.

#### Inputs

| Param     | Type           | Description                                              | Required? |
| --------- | -------------- | -------------------------------------------------------- | --------- |
| uuid      | UUID           | UUID of instance                                         | yes       |
| action    | string         | One of 'update', 'replace', 'delete'. Default is update. | no        |
| params    | object         | zone parameters                                          | no        |
| metadata  | object         | zone metadata                                            | no        |
| manifests | array of UUIDs | configuration manifests                                  | no        |

#### Responses

| Code | Description       | Response                |
| ---- | ----------------- | ----------------------- |
| 200  | Updates completed | Updated instance object |
| 404  | No instance found | none                    |

#### Example

    PUT /instances/b0d2f944-7fa3-11e2-a53c-3f3c7a8e7341 -d '{
      "action": "update",
      "metadata" {
        "MORAY": "3.moray.manta.joyent.us"
      }
    }'

### UpgradeInstance (PUT /instances/:uuid/upgrade)

Upgrades an instance to a newer image version.  This endpoint uses the
VMAPI.reprovisionVm() endpoint.

#### Inputs

| Param      | Type | Description       | Required? |
| ---------- | ---- | ----------------- | --------- |
| uuid       | UUID | UUID of instance  | yes       |
| image_uuid | UUID | UUID of new image | yes       |

#### Responses

| Code | Description       | Response                |
| ---- | ----------------- | ----------------------- |
| 200  | Updates completed | Updated instance object |
| 404  | No instance found | none                    |

#### Example

    PUT /instances/b0d2f944-7fa3-11e2-a53c-3f3c7a8e7341 -d '{
      "image_uuid": "01df6bd2-b132-11e2-b6df-ef5e1316b487"
    }'

### DeleteInstance (DELETE /instances/:instance_uuid)

#### Inputs

| Param | Type | Description      | Required? |
| ----- | ---- | ---------------- | --------- |
| uuid  | UUID | UUID of instance | yes       |

#### Responses

| Code | Description          | Response |
| ---- | -------------------- | -------- |
| 204  | Instance was deleted | none     |

## Manifests

### CreateManifest (POST /manifests)

Create a configuration manifest.

### ListManifests (GET /manifests)

Get all configuration manifests.

### GetManifest (GET /manifests/:uuid)

Get a particular configuration manifest.

### DeleteManifest (DELETE /manifests/:uuid)

Delete this configuration manifest.

## Modes

### GetMode (GET /mode)

Gets the current SAPI mode.

### SetMode (POST /mode?mode=full)

Changes the current mode to the specified one.

## Configs

### GetConfig (GET /configs/:uuid)

Gets the full set of metadata and manifests for a given instance.  This set is
determined by taking the union of the application's, service's, and instance's
data (last one wins).

In addition, there are a few instance-specific metadata keys that are added.
Note: As of [SAPI-248] **these are all deprecated.** Do not use them in new
code.

| Key           | Description |
| ------------- | ----------- |
| ZONE_UUID     | The zonename of that instance. New SAPI templates should use `{{{auto.ZONENAME}}}`. |
| SERVER_UUID   | The server (CN) UUID on which the instance is running. New SAPI templates should use `{{{auto.SERVER_UUID}}}`. |
| INSTANCE_UUID | The instance UUID (same as the zonename). New SAPI templates should use `{{{auto.ZONENAME}}}`. |

#### Example

    $ sdc-sapi /configs/$(vmadm lookup -1 alias=vmapi0)
    HTTP/1.1 200 OK
    Etag: c05101e85b6e49d231fa4c076edb6149508e831c
    Content-Type: application/json
    Content-Length: 11147
    Date: Tue, 27 Jan 2015 00:55:07 GMT
    Connection: keep-alive

    {
      "manifests": [
        {
          "uuid": "3f92e01b-3880-41d4-a024-fcdbb88d1771",
          "name": "registrar",
          "path": "/opt/smartdc/registrar/etc/config.json",
          "template": "{\n  \"registration\": {\n    \"domain\": \"{{...",
          "version": "1.0.0"
        },
        ...
      ],
      "metadata": {
        ...
        "datacenter_name": "coal",
        "pkg_3": "sdc_512:512:1024:25600:200:1000:10:5dd022c8-5388-43e3-9fdd-536df4ea4f9f",
        ...
      }
    }

## Cache

### SyncCache (POST /cache)

With the introduction of a local cache in SAPI to offset the problems that occur
in SAPI when Moray is down, there may be times when an operator wants to ensure
that the local cache of the SDC application and its services, instances, and
manifests are up to date.  This API will sync all SDC-application moray objects
into the local, on disk, cache (located at `/sapi` in the zone).  Otherwise, the
cache gets automatically refreshed every hour.

Note that this API would needs to be called for each SAPI individually to ensure
that they all have the most up-to-date objects.

    sdc-sapi /cache -X POST

## Multi DC mode

SAPI supports a cross-DC configuration mode. This is intended to support
multi-DC applications like Manta.
In this mode, there are typically three DCs with three separate Triton
deployments with [UFDS linked together](https://docs.joyent.com/private-cloud/install/headnode-installation/linked-data-centers).
There are also cross-DC routes for the admin network, which enables
cross-DC DNS to be setup.

But there's only one "manta" application, and Manta-related deployment
operations need to be operating on that one "manta" application object.

Note that Triton itself, even with linked datacenters does not need linked
sapi.

Prerequisites:

* Set up a multi-DC Triton deployment (with linked UFDS and inter-datacenter
  routes) inside a single region.
* Pick one of the DCs within the region to be the SAPI master. (The same
  DC with the UFDS master if any; otherwise any of them)
* Ensure cross-DC "admin" network routes are available, at least among the
  SAPI zones and the Moray zones in the master's DC.
* Ensure that cross-DC nameservices are working. This should happen
  automatically with UFDS replication and routes set up.

The steps needed to set this up are:

* In the two non-master DCs, update the SAPI service's metadata so that
  `MASTER_MORAY_IP` refers to the DNS domain of the Moray instance in the
  master DC, and `MASTER_MORAY_PORT` should likely be `2020`.

        sapi_svc=$(sdc-sapi /services?name=sapi | json -Ha uuid)
        sapiadm update $sapi_svc metadata.MASTER_MORAY_IP=moray.<primary-datacenter>.<datacenter domain suffix>
        sapiadm update $sapi_svc metadata.MASTER_MORAY_PORT=2020

  Note that originally `MASTER_MORAY_IP` was intended to be an IP but
  now it's recommended to use DNS names in order to prevent possible errors
  in case the IP address of the SAPI master changes. (Either way, IP
  addresses are still supported for backwards compatibility).
* After that, you can proceed with the "manta-init" phases of Manta setup.

Client `GET` requests to [List Applications](#ListApplications),
[List Instances](#ListInstances), [List Manifests](#ListManifests) and
[List Services](#ListServices) can specify `include_master=true`, in which case
SAPI will fetch data from its master's Moray and will include both local and
master data into the response.

Client `POST` request to [Create Application](#CreateApplication),
[Create Instance](#CreateInstance), [Create Manifest](#CreateManifest) and
[Create Services](#CreateService) can specify `master=true`, in which case
SAPI will store the data into its master's moray.

Finally, any `DELETE` request made for any of these end-points will always
try to delete the records from the local moray storage and, in case it's not
found there, will attempt the deletion from its master's moray.

Option `include_master` has no effect when requesting from the master.

## Metrics

SAPI exposes metrics via [node-triton-metrics](https://github.com/TritonDataCenter/node-triton-metrics) on `http://<ADMIN_IP>:8881/metrics`

## API Versions

### 1.0.0

Original SAPI version, including:

* [Applications](#applications)
* [Services](#services)
* [Instances](#instances)
* [Manifests](#manifests)
* [Modes](#modes)
* [Configs](#configs)
* [Cache](#cache)

### 2.0.0

* Added support for `type` field on SAPI instances. Added `type` as a supported
  search filter for instances.
