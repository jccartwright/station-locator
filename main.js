//global container for application properties
var app;

require([
    "esri/Map",
    "esri/views/MapView",
    "esri/views/SceneView",
    "esri/layers/MapImageLayer",
    "esri/tasks/QueryTask",
    "esri/tasks/support/Query",
    "esri/tasks/IdentifyTask",
    "esri/tasks/support/IdentifyParameters",
    "esri/Graphic",
    "esri/symbols/Symbol",
    "esri/widgets/Sketch/SketchViewModel",
    "esri/layers/GraphicsLayer",
    "esri/geometry/support/webMercatorUtils",
    "esri/widgets/Search",
    "esri/widgets/BasemapGallery",
    "esri/core/watchUtils",
    "dojo/query",
    "dojo/on",
    "dojo/dom",
    "dojo/_base/declare",
    "dojo/_base/array",
    "dgrid/Grid",
    "dgrid/OnDemandGrid",
    "dgrid/extensions/ColumnHider",
    "dojo/store/Memory",
    "dstore/legacy/StoreAdapter",
    "dgrid/Selection",
    "esri/request",
    "esri/config",
    "calcite-maps/calcitemaps-v0.7",
    "calcite-maps/calcitemaps-arcgis-support-v0.7",
    "bootstrap/Collapse",
    "bootstrap/Dropdown",
    "bootstrap/Tab",
    "dojo/domReady!"
], function(Map,
            MapView,
            SceneView,
            MapImageLayer,
            QueryTask,
            Query,
            IdentifyTask,
            IdentifyParameters,
            Graphic,
            Symbol,
            SketchViewModel,
            GraphicsLayer,
            webMercatorUtils,
            Search,
            Basemaps,
            watchUtils,
            query,
            on,
            dom,
            declare,
            arrayUtils,
            Grid,
            OnDemandGrid,
            ColumnHider,
            Memory,
            StoreAdapter,
            Selection,
            esriRequest,
            esriConfig,
            CalciteMaps,
            CalciteMapsArcGIS) {

    //required for ORDS webservice
    esriConfig.request.corsEnabledServers.push('https://www.ncdc.noaa.gov');

    /******************************************************************
     *
     * App settings
     *
     ******************************************************************/
    app = {
        center: [-82.56, 35.38],
        scale: 50000000,
        basemap: "streets",
        viewPadding: {
            top: 50,
            bottom: 0
        },
        uiComponents: ["zoom", "attribution"],
        mapView: null,
        containerMap: "mapViewDiv",
        activeView: null,
        searchWidget: null,
        serviceUrl: 'https://www.ncdc.noaa.gov/ords/stations/ghcnd/',
        numStations: 10,
        mapserviceUrl: 'https://gis.ncdc.noaa.gov/arcgis/rest/services/cdo/ghcnd_test/MapServer',
        searchPointSymbol: null,
        selectedPointSymbol: null,
        searchPointGraphic: null
    };

    //match the one used by the Search widget
    app.searchPointSymbol = {
        "type": "picture-marker",
        "url": "https://js.arcgis.com/4.7/esri/images/search/search-symbol-32.svg",
        "height": 24,
        "width": 24
    };

    app.selectedPointSymbol = {
        type: "simple-marker",
        style: "circle",
        color: "orange",
        size: "12px",
        outline: { // autocasts as new SimpleLineSymbol()
            color: [255, 255, 0],
            width: 2 // points
        }
    };




    /******************************************************************
     *
     * setup Grid
     *
     ******************************************************************/
        // create a new datastore for the on-demand grid. used to display list of stations
    var dataStore = new StoreAdapter({
            objectStore: new Memory({
                idProperty: "station_id"
            })
        });

    var grid = new(declare([OnDemandGrid, Selection, ColumnHider]))({
        columns: {
            station_id: 'Id',
            station_name: 'Name',
            distance: 'Distance'
        }
    }, "grid");
    grid.on('dgrid-select', selectFeatureFromGrid);

    //Query task used to retrieve details of selected station
    var queryTask = new QueryTask({
        url: app.mapserviceUrl+'/0'
    });
    var querySupport = new Query();
    querySupport.returnGeometry = true;
    querySupport.outFields = ["*"];


    //show the station from the selected grid row on the map
    function selectFeatureFromGrid(event) {
        querySupport.where = "station_id = '"+event.rows[0].id+"'";
        // When resolved, returns features and graphics that satisfy the query.
        queryTask.execute(querySupport).then(function(results){

            app.mapView.graphics.removeAll();
            // app.mapView.graphics.add(app.searchWidget.resultGraphic);
            app.mapView.graphics.add(app.searchPointGraphic);

            // create a new selected graphic
            var selectedGraphic = new Graphic({
                geometry: webMercatorUtils.geographicToWebMercator(results.features[0].geometry),
                symbol: app.selectedPointSymbol
            });

            // graphic corresponds to the row that was clicked
            app.mapView.graphics.add(selectedGraphic);
        }).catch(function (error) {
            console.error(error);
        });
    }


    /******************************************************************
     *
     * Create the map view and ui components
     *
     ******************************************************************/
    var stationsLayer = new MapImageLayer({
        url: app.mapserviceUrl,
        minScale: 3000000
    });

    var map = new Map({
        basemap: app.basemap,
        layers: [stationsLayer]
    });

    app.mapView = new MapView({
        container: app.containerMap,
        map: map,
        center: app.center,
        scale: app.scale,
        padding: app.viewPadding,
        ui: {
            components: app.uiComponents
        }
    });


    app.mapView.when(function(){
        //draw point
        app.mapView.ui.add("mapPointBtn", "top-left");

        var sketchViewModel = new SketchViewModel({
            view: app.mapView,
            layer: new GraphicsLayer(),
            pointSymbol: app.searchPointSymbol
        });
        sketchViewModel.on("draw-complete", function(evt) {
            showSearchPointAndZoom(evt.geometry);
            getClosestStations(evt.geometry);
        });

        var drawPointButton = document.getElementById("mapPointBtn");
        drawPointButton.onclick = function() {
            // set the sketch to create a point geometry
            sketchViewModel.create("point");
        };

        //Identify
        app.mapView.on('click', executeIdentifyTask);

        app.identifyTask = new IdentifyTask(app.mapserviceUrl);
        app.identifyParams = new IdentifyParameters();
        app.identifyParams.tolerance = 3;
        //default to GHCN. allow user to choose
        app.identifyParams.layerIds = [0];
        app.identifyParams.layerOption = 'top';
        app.identifyParams.width = app.mapView.width;
        app.identifyParams.height = app.mapView.height;
    });


    /******************************************************************
     *
     * setup widgets
     *
     ******************************************************************/
    // Create the search widget and add it to the navbar instead of view
    app.searchWidget = new Search({
        view: app.activeView,
        popupOpenOnSelect: false
    }, "searchWidgetDiv");

    CalciteMapsArcGIS.setSearchExpandEvents(app.searchWidget);

    app.searchWidget.on('select-result', function(event){
        showSearchPointAndZoom(event.result.feature.geometry);
        getClosestStations(event.result.feature.geometry);
    });

    // Create basemap widget
    app.basemapWidget = new Basemaps({
        view: app.mapView,
        container: "basemapPanelDiv"
    });


    /******************************************************************
     *
     * apply changes made in the settings widget
     *
     ******************************************************************/
    query("#settingsNumResults").on("change", function(e) {
        app.numStations = e.target.options[e.target.selectedIndex].value;
        console.log(app.numStations);
    });

    query("#settingsStations").on("change", function(e) {
        //TODO. change mapservice, webservice URLs
        console.log(e.target.options[e.target.selectedIndex].value);
    });


    /******************************************************************
     *
     * support functions
     *
     ******************************************************************/
    function showSearchPointAndZoom(geometry) {
        app.mapView.graphics.removeAll();

        app.searchPointGraphic = new Graphic({
            geometry: geometry,
            symbol: app.searchPointSymbol
        });

        app.mapView.graphics.add(app.searchPointGraphic);

        app.mapView.goTo({target: geometry, zoom: 10} );
    }


    //call Oracle REST service and populate grid
    function getClosestStations(geometry) {
        var url = app.serviceUrl + geometry.longitude + '/' + geometry.latitude + '/' + app.numStations;
        esriRequest(url).then(function(response) {
            var responseJSON = JSON.stringify(response, null, 2);
            dataStore.objectStore.data = response.data.items;
            grid.set("collection", dataStore);
        });
    }


    function executeIdentifyTask(event) {
        app.identifyParams.geometry = event.mapPoint;
        app.identifyParams.mapExtent = app.mapView.extent;
        // dom.byId(app.containerMap).style.cursor = "wait";

        app.identifyTask.execute(app.identifyParams).then(function(response) {
            var results = response.results;
            console.log(results);

            return arrayUtils.map(results, function(result) {
                var feature = result.feature;
                var layerName = result.layerName;
                feature.attributes.layerName = layerName;
                feature.popupTemplate = {
                    title: '{STATION_ID}',
                    content: '<b>Name:</b>{STATION_NAME} <br><b> Date Range:</b> {DATA_BEGIN_DATE} - {DATA_END_DATE}'
                }
                return(feature);
           })
        }).then(showPopup);


        function showPopup(response) {
            if (response.length > 0) {
                app.mapView.popup.open({
                    features: response,
                    location: event.mapPoint
                })
            }
        }
    }



});