package com.example.constructiontracker.controller;

import com.example.constructiontracker.auth.RequestIdentity;
import com.example.constructiontracker.dto.AdvanceHouseRequest;
import com.example.constructiontracker.dto.CreateHouseRequest;
import com.example.constructiontracker.dto.HouseDetailResponse;
import com.example.constructiontracker.dto.HouseListQuery;
import com.example.constructiontracker.dto.HouseResponse;
import com.example.constructiontracker.dto.SetCoverRequest;
import com.example.constructiontracker.service.HouseService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/houses")
public class HouseController {
    private final HouseService service;

    public HouseController(HouseService service) {
        this.service = service;
    }

    @GetMapping("/{id}")
    public HouseDetailResponse detail(@PathVariable Long id) {
        return service.detail(id);
    }

    @GetMapping
    public List<HouseResponse> list(@RequestParam(required = false) String bbox,
                                    @RequestParam(required = false) String stage,
                                    @RequestParam(required = false) String minLat,
                                    @RequestParam(required = false) String maxLat,
                                    @RequestParam(required = false) String minLng,
                                    @RequestParam(required = false) String maxLng) {
        return service.listResponses(HouseListQuery.parse(bbox, stage, minLat, maxLat, minLng, maxLng));
    }

    @PutMapping("/{id}/cover")
    public HouseDetailResponse setCover(@PathVariable Long id, @Valid @RequestBody SetCoverRequest body,
                                       HttpServletRequest request) {
        return service.setCover(id, body, RequestIdentity.get(request));
    }

    @PostMapping("/{id}/advance")
    public HouseDetailResponse advance(@PathVariable Long id, @Valid @RequestBody AdvanceHouseRequest body,
                                       HttpServletRequest request) {
        return service.advance(id, body, RequestIdentity.get(request));
    }

    @PostMapping
    public ResponseEntity<HouseResponse> create(@Valid @RequestBody CreateHouseRequest body,
                                               HttpServletRequest request) {
        var result = service.create(body, RequestIdentity.get(request));
        return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK)
                .body(HouseResponse.from(result.house()));
    }
}
